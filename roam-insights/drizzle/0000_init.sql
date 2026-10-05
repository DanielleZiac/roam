CREATE TABLE `activity_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`actor` enum('merchant','system') NOT NULL,
	`action` varchar(64) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`details` json,
	`product_id` int,
	`alert_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`type` enum('unmet_need','low_conversion') NOT NULL,
	`severity` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`status` enum('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
	`need_tag` varchar(64),
	`product_id` int,
	`message` varchar(500) NOT NULL,
	`metric` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`resolved_at` timestamp,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_needs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`need_tag` varchar(64) NOT NULL,
	CONSTRAINT `event_needs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_picks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`product_id` int,
	`product_handle` varchar(255) NOT NULL,
	`position` int NOT NULL,
	`added_to_cart_at` timestamp,
	CONSTRAINT `event_picks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`shopify_product_id` varchar(64) NOT NULL,
	`handle` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`product_type` varchar(255) NOT NULL DEFAULT '',
	`need_tags` json NOT NULL,
	`key_facts` json NOT NULL,
	`summary` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_shop_handle_unique` UNIQUE(`shop`,`handle`),
	CONSTRAINT `products_shop_shopify_id_unique` UNIQUE(`shop`,`shopify_product_id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(255) NOT NULL,
	`shop` text NOT NULL,
	`state` text NOT NULL,
	`isOnline` boolean NOT NULL DEFAULT false,
	`scope` text,
	`expires` timestamp,
	`accessToken` text NOT NULL,
	`userId` bigint,
	`firstName` text,
	`lastName` text,
	`email` text,
	`accountOwner` boolean,
	`locale` text,
	`collaborator` boolean,
	`emailVerified` boolean,
	`refreshToken` text,
	`refreshTokenExpires` timestamp,
	CONSTRAINT `session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suggestion_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`pick_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suggestion_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_alert_id_alerts_id_fk` FOREIGN KEY (`alert_id`) REFERENCES `alerts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_needs` ADD CONSTRAINT `event_needs_event_id_suggestion_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `suggestion_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_picks` ADD CONSTRAINT `event_picks_event_id_suggestion_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `suggestion_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_picks` ADD CONSTRAINT `event_picks_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_log_shop_created_idx` ON `activity_log` (`shop`,`created_at`);--> statement-breakpoint
CREATE INDEX `alerts_shop_status_idx` ON `alerts` (`shop`,`status`);--> statement-breakpoint
CREATE INDEX `event_needs_event_idx` ON `event_needs` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_needs_tag_idx` ON `event_needs` (`need_tag`);--> statement-breakpoint
CREATE INDEX `event_picks_event_idx` ON `event_picks` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_picks_product_idx` ON `event_picks` (`product_id`);--> statement-breakpoint
CREATE INDEX `suggestion_events_shop_created_idx` ON `suggestion_events` (`shop`,`created_at`);