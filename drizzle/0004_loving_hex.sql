DROP INDEX `idx_gateway_message_member_clordid`;--> statement-breakpoint
CREATE INDEX `idx_gateway_message_member_clordid` ON `gateway_messages` (`member_id`,`client_order_id`);