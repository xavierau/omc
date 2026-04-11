ALTER TABLE restaurants ADD COLUMN plan VARCHAR(20) NOT NULL DEFAULT 'starter';
ALTER TABLE restaurants ADD CONSTRAINT chk_plan CHECK (plan IN ('starter', 'growth', 'pro'));
