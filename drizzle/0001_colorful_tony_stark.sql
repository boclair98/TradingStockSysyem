CREATE TABLE `audit_chain` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`payload_json` text NOT NULL,
	`previous_hash` text NOT NULL,
	`entry_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_chain_user_time` ON `audit_chain` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_idempotency` (
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_created_at` ON `order_idempotency` (`created_at`);--> statement-breakpoint
CREATE TABLE `venue_control` (
	`venue` text PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`halt_mode` text DEFAULT 'OPEN' NOT NULL,
	`reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
