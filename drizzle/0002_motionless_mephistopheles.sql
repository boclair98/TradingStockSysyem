CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`observed_price` integer,
	`order_id` text,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_runs_strategy_time` ON `automation_runs` (`strategy_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_runs_user_time` ON `automation_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`strategy_type` text NOT NULL,
	`trigger_operator` text NOT NULL,
	`trigger_price` integer,
	`order_type` text NOT NULL,
	`limit_price` integer,
	`quantity` integer NOT NULL,
	`interval_seconds` integer DEFAULT 60 NOT NULL,
	`max_orders_per_day` integer DEFAULT 1 NOT NULL,
	`max_daily_notional` integer DEFAULT 1000000 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`execution_mode` text DEFAULT 'paper' NOT NULL,
	`last_evaluated_at` text,
	`last_triggered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_automation_strategies_user_status` ON `automation_strategies` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_strategies_due` ON `automation_strategies` (`status`,`last_evaluated_at`);--> statement-breakpoint
CREATE TABLE `broker_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`mode` text DEFAULT 'sandbox' NOT NULL,
	`account_label` text NOT NULL,
	`account_ref` text NOT NULL,
	`credential_ciphertext` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_checked_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_broker_connections_user_provider_account` ON `broker_connections` (`user_id`,`provider`,`account_ref`);--> statement-breakpoint
CREATE INDEX `idx_broker_connections_user_status` ON `broker_connections` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `broker_rate_windows` (
	`provider` text NOT NULL,
	`connection_id` text NOT NULL,
	`rate_group` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `connection_id`, `rate_group`)
);
