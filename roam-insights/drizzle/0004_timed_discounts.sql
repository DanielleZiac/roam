CREATE TABLE `timed_discounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`kind` enum('percent','amount') NOT NULL,
	`value` decimal(12,2) NOT NULL,
	`product_ids` json NOT NULL,
	`starts_at` timestamp NOT NULL,
	`ends_at` timestamp,
	`status` enum('scheduled','active','finished','cancelled') NOT NULL DEFAULT 'scheduled',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `timed_discounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `timed_discounts_status_idx` ON `timed_discounts` (`status`,`shop`);