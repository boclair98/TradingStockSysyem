CREATE TABLE `broker_tokens` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`token_ciphertext` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`live_order_id` text NOT NULL,
	`execution_ref` text NOT NULL,
	`price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`venue` text NOT NULL,
	`executed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_live_executions_order_ref` ON `live_executions` (`live_order_id`,`execution_ref`);--> statement-breakpoint
CREATE INDEX `idx_live_executions_time` ON `live_executions` (`executed_at`);--> statement-breakpoint
CREATE TABLE `live_order_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_json` text NOT NULL,
	`quote_price` integer NOT NULL,
	`estimated_notional` integer NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_live_previews_user_expiry` ON `live_order_previews` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `live_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`client_order_id` text NOT NULL,
	`broker_order_id` text,
	`broker_org_no` text,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`time_in_force` text NOT NULL,
	`venue` text NOT NULL,
	`price` integer,
	`quantity` integer NOT NULL,
	`executed_quantity` integer DEFAULT 0 NOT NULL,
	`average_price` integer,
	`status` text NOT NULL,
	`broker_code` text,
	`broker_message` text,
	`submitted_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_live_orders_user_client_order` ON `live_orders` (`user_id`,`client_order_id`);--> statement-breakpoint
CREATE INDEX `idx_live_orders_user_updated` ON `live_orders` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_live_orders_connection_status` ON `live_orders` (`connection_id`,`status`);--> statement-breakpoint
CREATE TABLE `live_risk_policies` (
	`user_id` text PRIMARY KEY NOT NULL,
	`live_enabled` integer DEFAULT 0 NOT NULL,
	`automation_enabled` integer DEFAULT 0 NOT NULL,
	`kill_switch` integer DEFAULT 1 NOT NULL,
	`max_order_quantity` integer DEFAULT 10 NOT NULL,
	`max_order_notional` integer DEFAULT 1000000 NOT NULL,
	`max_daily_notional` integer DEFAULT 5000000 NOT NULL,
	`max_open_orders` integer DEFAULT 5 NOT NULL,
	`allowed_symbols_json` text DEFAULT '[]' NOT NULL,
	`acknowledged_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
