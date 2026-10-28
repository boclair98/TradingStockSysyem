CREATE TABLE `engine_runtime_state` (
	`venue` text PRIMARY KEY NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
