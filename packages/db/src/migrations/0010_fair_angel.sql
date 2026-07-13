ALTER TABLE `thread` ADD `comment_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `thread` ADD `opening_excerpt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `thread` ADD `working` text;