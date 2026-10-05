ALTER TABLE `reviews` ADD `customer_id` varchar(32);--> statement-breakpoint
ALTER TABLE `reviews` ADD `verified_buyer` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_product_customer_unique` UNIQUE(`product_id`,`customer_id`);