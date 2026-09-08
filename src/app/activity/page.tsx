import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Rss, Star } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { MediaCover } from "@/components/media-cover";
import { MediaBadge } from "@/components/media-badge";
import { SpoilerText } from "@/components/spoiler-text";
import { getSession } from "@/lib/pocketbase/session";
import { getSuperuserClient } from "@/lib/pocketbase/superuser";
import { formatRelativeTime } from "@/lib/i18n";
import { getDisplayName, getInitials } from "@/lib/format";
import { getServerTranslations, getLocale } from "@/lib/i18n/server";
import type {
  CommentsResponse,
  GroupMembersResponse,
  GroupsResponse,
  ReviewsResponse,
  TitlesResponse,
  UsersResponse,
} from "@/types/pocketbase-types";

type ActivityItem =
  | {
      kind: "proposed";
      at: string;
      title: TitlesResponse<{ group?: GroupsResponse; addedBy?: UsersResponse }>;
    }
  | {
      kind: "reviewed";
      at: string;
      review: ReviewsResponse<{
        title?: TitlesResponse<{ group?: GroupsResponse }>;
        user?: UsersResponse;
      }>;
    }
  | {
      kind: "commented";
      at: string;
      comment: CommentsResponse<{
        title?: TitlesResponse<{ group?: GroupsResponse }>;
        user?: UsersResponse;
      }>;
    };

export default async function ActivityPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pb = await getSuperuserClient();
  const t = await getServerTranslations();
  const locale = await getLocale();

  const memberships = await pb
    .collection("group_members")
    .getFullList<GroupMembersResponse>({
      filter: pb.filter("user = {:userId}", { userId: session.id }),
    });

  const groupIds = memberships.map((m) => m.group);
  let items: ActivityItem[] = [];

  if (groupIds.length > 0) {
    const filterParams = Object.fromEntries(groupIds.map((id, i) => [`g${i}`, id]));
    const titleGroupFilter = pb.filter(
      `(${groupIds.map((_, i) => `group = {:g${i}}`).join(" || ")})`,
      filterParams,
    );
    const reviewGroupFilter = pb.filter(
      `(${groupIds.map((_, i) => `title.group = {:g${i}}`).join(" || ")})`,
      filterParams,
    );
    const commentGroupFilter = pb.filter(
      `(${groupIds.map((_, i) => `group = {:g${i}}`).join(" || ")})`,
      filterParams,
    );

    const [titles, reviews, comments] = await Promise.all([
      pb
        .collection("titles")
        .getList<TitlesResponse<{ group?: GroupsResponse; addedBy?: UsersResponse }>>(
          1,
          30,
          { filter: titleGroupFilter, expand: "group,addedBy", sort: "-createdAt" },
        ),
      pb
        .collection("reviews")
        .getList<
          ReviewsResponse<{
            title?: TitlesResponse<{ group?: GroupsResponse }>;
            user?: UsersResponse;
          }>
        >(1, 30, {
          filter: reviewGroupFilter,
          expand: "title.group,user",
          sort: "-createdAt",
        }),
      pb
        .collection("comments")
        .getList<
          CommentsResponse<{
            title?: TitlesResponse<{ group?: GroupsResponse }>;
            user?: UsersResponse;
          }>
        >(1, 30, {
          filter: commentGroupFilter,
          expand: "title.group,user",
          sort: "-createdAt",
        }),
    ]);

    const unsorted: ActivityItem[] = [
      ...titles.items.map((title): ActivityItem => ({
        kind: "proposed",
        at: title.createdAt,
        title,
      })),
      ...reviews.items.map((review): ActivityItem => ({
        kind: "reviewed",
        at: review.createdAt,
        review,
      })),
      ...comments.items.map((comment): ActivityItem => ({
        kind: "commented",
        at: comment.createdAt,
        comment,
      })),
    ];
    // Precompute timestamps once — parsing inside the comparator repeats
    // Date construction O(n log n) times per render.
    items = unsorted
      .map((item) => {
        const atTime = Date.parse(item.at);
        return { item, atTime: Number.isNaN(atTime) ? 0 : atTime };
      })
      .sort((a, b) => b.atTime - a.atTime)
      .map(({ item }) => item);
  }

  const currentUser = {
    id: session.id,
    email: session.email,
    name: session.name,
    avatarUrl: session.avatarUrl,
    isAdmin: session.isAdmin,
  };

  return (
    <AppShell user={currentUser} maxWidth="wide" title={t.activity.title}>
      <div className="flex flex-col gap-6">
        <div className="pb-4 border-b border-border/60">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t.activity.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t.activity.subtitle}
          </p>
        </div>

        {items.length > 0 ? (
          <div className="space-y-3">
            {items.slice(0, 30).map((item) => {
              if (item.kind === "proposed") {
                const { title } = item;
                const group = title.expand?.group;
                const author = title.expand?.addedBy;
                const authorName = getDisplayName(author, t.common.unnamedUser);
                const initials = getInitials(author?.name, author?.email);

                return (
                  <Link
                    key={`t-${title.id}`}
                    href={group ? `/groups/${group.id}` : "#"}
                    className="group block"
                  >
                    <Card className="border-border/60 hover:border-primary/40 transition-all duration-200">
                      <CardContent className="p-4 flex items-start gap-3 sm:gap-4">
                        <Avatar size="sm" className="shrink-0 mt-0.5">
                          {author?.avatarUrl && <AvatarImage src={author.avatarUrl} alt={authorName} />}
                          <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground">{authorName}</span>
                              <span>{t.activity.proposed}</span>
                              {group && (
                                <>
                                  <span>&middot;</span>
                                  <Badge variant="secondary" className="text-[10px] font-mono font-medium py-0 rounded-xs">
                                    {group.name}
                                  </Badge>
                                </>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {formatRelativeTime(title.createdAt, locale)}
                            </span>
                          </div>

                          <div className="flex items-start gap-3 p-2.5 rounded-xs bg-muted/30 border border-border/60 group-hover:bg-muted/50 transition-colors">
                            <MediaCover
                              src={title.coverUrl}
                              alt={title.title}
                              size="sm"
                              className="shrink-0 rounded-sm"
                            />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <MediaBadge type={title.mediaType} size="sm" />
                              </div>
                              <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                                {title.title}
                              </p>
                              {title.creator && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {title.creator}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              } else if (item.kind === "reviewed") {
                const { review } = item;
                const title = review.expand?.title;
                const group = title?.expand?.group;
                const reviewer = review.expand?.user;
                const reviewerName = getDisplayName(reviewer, t.common.unnamedUser);
                const initials = getInitials(reviewer?.name, reviewer?.email);

                return (
                  <Link
                    key={`r-${review.id}`}
                    href={group ? `/groups/${group.id}` : "#"}
                    className="group block"
                  >
                    <Card className="border-border/60 hover:border-primary/40 transition-all duration-200">
                      <CardContent className="p-4 flex items-start gap-3 sm:gap-4">
                        <Avatar size="sm" className="shrink-0 mt-0.5">
                          {reviewer?.avatarUrl && <AvatarImage src={reviewer.avatarUrl} alt={reviewerName} />}
                          <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground">{reviewerName}</span>
                              <span>{t.activity.reviewed}:</span>
                              <span className="font-semibold text-foreground line-clamp-1">{title?.title}</span>
                              {group && (
                                <>
                                  <span>&middot;</span>
                                  <Badge variant="secondary" className="text-[10px] font-mono font-medium py-0 rounded-xs">
                                    {group.name}
                                  </Badge>
                                </>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {formatRelativeTime(review.createdAt, locale)}
                            </span>
                          </div>

                          <div className="p-3 rounded-xs bg-muted/30 border border-border/60 space-y-1.5 group-hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-1 text-amber-400">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`size-3.5 ${
                                    i < review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                                  }`}
                                />
                              ))}
                              <span className="text-xs font-semibold font-mono text-foreground ml-1.5">
                                {review.rating}.0 / 5.0
                              </span>
                            </div>

                            {review.reviewText && (
                              <div className="font-serif text-sm text-foreground/90 leading-relaxed italic">
                                &ldquo;<SpoilerText text={review.reviewText} />&rdquo;
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              } else if (item.kind === "commented") {
                const { comment } = item;
                const title = comment.expand?.title;
                const group = title?.expand?.group;
                const author = comment.expand?.user;
                const authorName = getDisplayName(author, t.common.unnamedUser);
                const initials = getInitials(author?.name, author?.email);

                return (
                  <Link
                    key={`c-${comment.id}`}
                    href={group ? `/groups/${group.id}` : "#"}
                    className="group block"
                  >
                    <Card className="border-border/60 hover:border-primary/40 transition-all duration-200">
                      <CardContent className="p-4 flex items-start gap-3 sm:gap-4">
                        <Avatar size="sm" className="shrink-0 mt-0.5">
                          {author?.avatarUrl && <AvatarImage src={author.avatarUrl} alt={authorName} />}
                          <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground">{authorName}</span>
                              <span>{t.activity.commented}:</span>
                              <span className="font-semibold text-foreground line-clamp-1">{title?.title}</span>
                              {group && (
                                <>
                                  <span>&middot;</span>
                                  <Badge variant="secondary" className="text-[10px] font-mono font-medium py-0 rounded-xs">
                                    {group.name}
                                  </Badge>
                                </>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {formatRelativeTime(comment.createdAt, locale)}
                            </span>
                          </div>

                          <div className="p-3 rounded-xs bg-muted/30 border border-border/60 space-y-1.5 group-hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-1 text-primary">
                              <MessageSquare className="size-3.5" />
                              <span className="text-xs font-medium text-muted-foreground">
                                {t.comments.title}
                              </span>
                            </div>
                            <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">
                              {comment.content}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              }
              return null;
            })}
          </div>
        ) : (
          <EmptyState
            icon={Rss}
            title={t.activity.noActivity}
            description={t.activity.noActivityDesc}
          />
        )}
      </div>
    </AppShell>
  );
}
