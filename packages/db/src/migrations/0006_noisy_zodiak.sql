CREATE TABLE `artifact` (
	`created_at` integer NOT NULL,
	`head_version_id` text NOT NULL,
	`home_channel_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifact_workspaceId_idx` ON `artifact` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `artifact_version` (
	`artifact_id` text NOT NULL,
	`byte_length` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`media_kind` text NOT NULL,
	`origin` text NOT NULL,
	`r2_key` text NOT NULL,
	`seq` integer NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifact_version_artifactId_seq_idx` ON `artifact_version` (`artifact_id`,`seq`);