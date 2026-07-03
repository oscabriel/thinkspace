CREATE TABLE `channel` (
	`created_at` integer NOT NULL,
	`goal` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`lifecycle` text NOT NULL,
	`owner_member_id` text NOT NULL,
	`shape_id` text NOT NULL,
	`visibility` text NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `channel_workspaceId_idx` ON `channel` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_shapeId_unique` ON `channel` (`shape_id`);--> statement-breakpoint
CREATE TABLE `shape` (
	`cloned_from` text,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`structure` text NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shape_workspaceId_idx` ON `shape` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `thread` (
	`channel_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_member_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`last_activity_at` integer NOT NULL,
	`lifecycle` text NOT NULL,
	`name` text NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_channelId_idx` ON `thread` (`channel_id`);--> statement-breakpoint
CREATE INDEX `thread_workspaceId_lastActivityAt_idx` ON `thread` (`workspace_id`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `unread` (
	`bumped_at` integer NOT NULL,
	`member_id` text NOT NULL,
	`reasons` text NOT NULL,
	`thread_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `member_id`, `thread_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_tool_disable` (
	`disabled_at` integer NOT NULL,
	`disabled_by_member_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `tool_id`)
);
