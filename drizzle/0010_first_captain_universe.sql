ALTER TABLE `live_orders` ADD `risk_notional` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `live_risk_policies` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `live_risk_policies` ADD `commit_token` text;