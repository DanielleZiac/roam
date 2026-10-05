CREATE TABLE `reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shop` varchar(255) NOT NULL,
	`product_id` int NOT NULL,
	`rating` int NOT NULL,
	`author_name` varchar(60) NOT NULL,
	`body` text NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`moderated_at` timestamp,
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `reviews_shop_status_idx` ON `reviews` (`shop`,`status`);--> statement-breakpoint
CREATE INDEX `reviews_product_idx` ON `reviews` (`product_id`);