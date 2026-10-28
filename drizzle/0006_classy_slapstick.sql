CREATE TABLE IF NOT EXISTS `_audit_chain_migration_guard` (
	`fork_count` integer NOT NULL CHECK (`fork_count` = 0)
);
--> statement-breakpoint
DELETE FROM `_audit_chain_migration_guard`;
--> statement-breakpoint
INSERT INTO `_audit_chain_migration_guard` (`fork_count`)
SELECT COUNT(*)
FROM (
	SELECT `candidate`.`user_id`
	FROM `audit_chain` AS `candidate`
	WHERE NOT EXISTS (
		SELECT 1 FROM `audit_chain` AS `child`
		WHERE `child`.`user_id` = `candidate`.`user_id`
		AND `child`.`previous_hash` = `candidate`.`entry_hash`
	)
	GROUP BY `candidate`.`user_id`
	HAVING COUNT(*) > 1
);
--> statement-breakpoint
DROP TABLE `_audit_chain_migration_guard`;
--> statement-breakpoint
CREATE TABLE `audit_chain_heads` (
	`user_id` text PRIMARY KEY NOT NULL,
	`entry_hash` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `audit_chain_heads` (`user_id`, `entry_hash`, `updated_at`)
SELECT `leaf`.`user_id`, `leaf`.`entry_hash`, `leaf`.`created_at`
FROM `audit_chain` AS `leaf`
WHERE NOT EXISTS (
	SELECT 1 FROM `audit_chain` AS `child`
	WHERE `child`.`user_id` = `leaf`.`user_id` AND `child`.`previous_hash` = `leaf`.`entry_hash`
)
AND (
	SELECT COUNT(*) FROM `audit_chain` AS `candidate`
	WHERE `candidate`.`user_id` = `leaf`.`user_id`
	AND NOT EXISTS (
		SELECT 1 FROM `audit_chain` AS `child_of_candidate`
		WHERE `child_of_candidate`.`user_id` = `candidate`.`user_id`
		AND `child_of_candidate`.`previous_hash` = `candidate`.`entry_hash`
	)
) = 1
ON CONFLICT(`user_id`) DO NOTHING;
--> statement-breakpoint
CREATE TABLE `automation_validation_progress` (
	`user_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_fingerprint` text NOT NULL,
	`validation_count` integer DEFAULT 0 NOT NULL,
	`trigger_count` integer DEFAULT 0 NOT NULL,
	`waiting_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `strategy_id`, `strategy_fingerprint`)
);
--> statement-breakpoint
CREATE INDEX `idx_automation_progress_user_strategy` ON `automation_validation_progress` (`user_id`,`strategy_id`);
