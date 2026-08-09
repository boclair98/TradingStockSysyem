CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_user_time` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `paper_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`cash_balance` integer DEFAULT 100000000 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paper_accounts_participant_id` ON `paper_accounts` (`participant_id`);--> statement-breakpoint
CREATE TABLE `paper_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`engine_execution_id` text NOT NULL,
	`symbol` text NOT NULL,
	`price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`buy_order_id` text NOT NULL,
	`sell_order_id` text NOT NULL,
	`buy_user_id` text NOT NULL,
	`sell_user_id` text NOT NULL,
	`executed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_paper_executions_buy_user_time` ON `paper_executions` (`buy_user_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_executions_sell_user_time` ON `paper_executions` (`sell_user_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_executions_symbol_time` ON `paper_executions` (`symbol`,`executed_at`);--> statement-breakpoint
CREATE TABLE `paper_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`time_in_force` text NOT NULL,
	`price` integer,
	`stop_price` integer,
	`quantity` integer NOT NULL,
	`remaining` integer NOT NULL,
	`status` text NOT NULL,
	`sequence` integer NOT NULL,
	`accepted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_paper_orders_user_updated` ON `paper_orders` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_paper_orders_symbol_status` ON `paper_orders` (`symbol`,`status`);--> statement-breakpoint
CREATE INDEX `idx_paper_orders_participant_status` ON `paper_orders` (`participant_id`,`status`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`average_price` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `symbol`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
