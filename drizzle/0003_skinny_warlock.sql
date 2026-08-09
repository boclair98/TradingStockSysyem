CREATE TABLE `drop_copy_events` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`market_sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`order_id` text,
	`execution_id` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_drop_copy_member_sequence_event` ON `drop_copy_events` (`member_id`,`market_sequence`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_drop_copy_member_time` ON `drop_copy_events` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `gateway_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`session_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_type` text NOT NULL,
	`session_sequence` integer NOT NULL,
	`market_sequence` integer,
	`client_order_id` text,
	`venue_order_id` text,
	`status` text NOT NULL,
	`reject_code` text,
	`payload_json` text NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`latency_micros` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gateway_message_session_sequence` ON `gateway_messages` (`session_id`,`direction`,`session_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gateway_message_member_clordid` ON `gateway_messages` (`member_id`,`client_order_id`);--> statement-breakpoint
CREATE INDEX `idx_gateway_message_market_sequence` ON `gateway_messages` (`market_sequence`);--> statement-breakpoint
CREATE INDEX `idx_gateway_message_received_at` ON `gateway_messages` (`received_at`);--> statement-breakpoint
CREATE TABLE `member_gateway_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`protocol` text DEFAULT 'NATIVE_JSON_1' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`expected_inbound_sequence` integer DEFAULT 1 NOT NULL,
	`outbound_sequence` integer DEFAULT 1 NOT NULL,
	`remote_address` text,
	`connected_at` text NOT NULL,
	`last_heartbeat_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gateway_sessions_member_status` ON `member_gateway_sessions` (`member_id`,`status`);