/// <reference path="../pb_data/types.d.ts" />

// Initial hepyeni schema: extends the built-in `users` auth collection with
// admin/ban/avatar fields and enables password auth alongside Google OAuth2
// and email OTP, then creates the 5 product collections (groups, group_members,
// titles, votes, reviews) — the PocketBase equivalent of
// src/db/schema.ts's 9 Postgres tables (the other 4 — user/account/session/
// verificationToken — dissolve into PocketBase's built-in auth machinery).
//
// Every collection's API rules are left `null` (superuser-only) — this app
// has no client-side PocketBase usage, so all authorization stays in
// Next.js server-action code exactly as it does today with Drizzle. See
// src/lib/pocketbase/superuser.ts.
//
// Google OAuth2 provider credentials are NOT configured here (secrets don't
// belong in committed migration code) — enable/configure the Google
// provider via the Admin UI or Settings API once the instance is deployed.

migrate((app) => {
  // --- extend the built-in `users` auth collection ---
  const users = app.findCollectionByNameOrId("users");

  users.fields.add(new BoolField({ name: "isAdmin", required: false }));
  users.fields.add(new DateField({ name: "bannedAt", required: false }));
  users.fields.add(
    new TextField({ name: "avatarUrl", required: false, max: 2000 }),
  );

  // Enable OAuth2, email OTP, and password authentication.
  users.passwordAuth.enabled = true;
  users.otp.enabled = true;

  app.save(users);

  // --- groups ---
  const groups = new Collection({
    type: "base",
    name: "groups",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "name", required: true, max: 200 },
      { type: "text", name: "inviteCode", required: true, max: 20 },
      {
        type: "relation",
        name: "createdBy",
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      },
      { type: "autodate", name: "createdAt", onCreate: true, onUpdate: false },
    ],
  });
  groups.addIndex("idx_groups_invite_code", true, "inviteCode");
  app.save(groups);

  // --- group_members ---
  const groupMembers = new Collection({
    type: "base",
    name: "group_members",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "relation",
        name: "group",
        required: true,
        collectionId: groups.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "relation",
        name: "user",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "select",
        name: "role",
        required: true,
        maxSelect: 1,
        values: ["owner", "member"],
      },
      { type: "autodate", name: "joinedAt", onCreate: true, onUpdate: false },
    ],
  });
  groupMembers.addIndex("idx_group_members_unique", true, "group, user");
  app.save(groupMembers);

  // --- titles ---
  const titles = new Collection({
    type: "base",
    name: "titles",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "relation",
        name: "group",
        required: true,
        collectionId: groups.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "select",
        name: "mediaType",
        required: true,
        maxSelect: 1,
        values: ["book", "movie", "tv", "music", "podcast"],
      },
      { type: "text", name: "externalSource", required: true, max: 100 },
      { type: "text", name: "externalId", required: true, max: 200 },
      { type: "text", name: "title", required: true, max: 300 },
      { type: "text", name: "creator", required: false, max: 300 },
      { type: "text", name: "coverUrl", required: false, max: 2000 },
      { type: "json", name: "metadata", required: false },
      {
        type: "select",
        name: "status",
        required: true,
        maxSelect: 1,
        values: ["proposed", "consumed"],
      },
      {
        type: "relation",
        name: "addedBy",
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      },
      { type: "autodate", name: "createdAt", onCreate: true, onUpdate: false },
      { type: "date", name: "consumedAt", required: false },
    ],
  });
  titles.addIndex(
    "idx_titles_group_external",
    true,
    "group, externalSource, externalId",
  );
  app.save(titles);

  // --- votes ---
  // Record id is client-supplied (deterministic hash of titleId+userId, see
  // src/lib/pocketbase/vote-id.ts) rather than auto-generated — that's what
  // makes the vote-toggle create atomic-by-construction. No schema change
  // needed for that; PocketBase always allows a valid custom id on create.
  const votes = new Collection({
    type: "base",
    name: "votes",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "relation",
        name: "title",
        required: true,
        collectionId: titles.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "relation",
        name: "user",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "select",
        name: "value",
        required: true,
        maxSelect: 1,
        values: ["up", "down"],
      },
      { type: "autodate", name: "createdAt", onCreate: true, onUpdate: false },
    ],
  });
  votes.addIndex("idx_votes_unique", true, "title, user");
  app.save(votes);

  // --- reviews ---
  const reviews = new Collection({
    type: "base",
    name: "reviews",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "relation",
        name: "title",
        required: true,
        collectionId: titles.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        type: "relation",
        name: "user",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      { type: "number", name: "rating", required: true, min: 1, max: 5 },
      { type: "text", name: "reviewText", required: false },
      { type: "autodate", name: "createdAt", onCreate: true, onUpdate: false },
    ],
  });
  reviews.addIndex("idx_reviews_unique", true, "title, user");
  app.save(reviews);
}, (app) => {
  for (const name of ["reviews", "votes", "titles", "group_members", "groups"]) {
    const collection = app.findCollectionByNameOrId(name);
    if (collection) app.delete(collection);
  }

  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("isAdmin");
  users.fields.removeByName("bannedAt");
  users.fields.removeByName("avatarUrl");
  users.passwordAuth.enabled = true;
  users.otp.enabled = false;
  app.save(users);
});
