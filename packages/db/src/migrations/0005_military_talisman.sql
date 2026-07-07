CREATE TABLE `skill` (
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`r2_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_workspaceId_idx` ON `skill` (`workspace_id`);