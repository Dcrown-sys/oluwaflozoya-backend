# Migrations

Until now the schema lived only inside the running Render database — there was
no copy in the repo, so it could not be reviewed, rebuilt, or recovered.

`db/schema.sql` is now the committed snapshot of the live structure, produced by:

    npm run db:dump

It is generated. Don't hand-edit it.

## Changing the schema

    npm run db:new -- add_listings_table    # creates a timestamped file here
    # edit the generated up/down
    npm run db:migrate                      # apply
    npm run db:dump                         # refresh the snapshot
    # commit the migration AND the refreshed schema.sql together

`npm run db:rollback` reverts the last one.

## Rules

- Every structural change goes through a migration. No more console edits.
- Write a real `down` — a migration you cannot reverse is one you cannot deploy
  with confidence.
- Run against a copy of production before running against production.
