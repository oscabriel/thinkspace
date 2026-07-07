CREATE TABLE `mcp_host_approval` (
	`approved_at` integer NOT NULL,
	`approved_by_owner_member_id` text NOT NULL,
	`host` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `host`)
);
--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`host` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`workspace_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_server_workspaceId_idx` ON `mcp_server` (`workspace_id`);