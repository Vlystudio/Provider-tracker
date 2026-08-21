ALTER TABLE "notifications" DROP CONSTRAINT "notifications_target_path_check";--> statement-breakpoint
UPDATE "notifications"
SET "target_path" = NULL
WHERE "target_path" IS NOT NULL AND NOT (
  char_length("target_path") <= 512
  AND left("target_path", 1) = '/'
  AND left("target_path", 2) <> '//'
  AND position(chr(92) IN "target_path") = 0
  AND "target_path" !~ '[[:cntrl:]]'
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_path_check" CHECK ("notifications"."target_path" is null or (
      char_length("notifications"."target_path") <= 512
      and left("notifications"."target_path", 1) = '/'
      and left("notifications"."target_path", 2) <> '//'
      and position(chr(92) in "notifications"."target_path") = 0
      and "notifications"."target_path" !~ '[[:cntrl:]]'
    ));
