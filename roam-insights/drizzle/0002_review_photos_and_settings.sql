CREATE TABLE `review_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`review_id` int NOT NULL,
	`mime_type` varchar(32) NOT NULL,
	`data` mediumtext NOT NULL,
	CONSTRAINT `review_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shop_settings` (
	`shop` varchar(255) NOT NULL,
	`auto_publish_reviews` boolean NOT NULL DEFAULT false,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shop_settings_shop` PRIMARY KEY(`shop`)
);
--> statement-breakpoint
ALTER TABLE `review_photos` ADD CONSTRAINT `review_photos_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `review_photos_review_idx` ON `review_photos` (`review_id`);