ALTER TABLE admissions
  DROP CONSTRAINT IF EXISTS admissions_check1,
  DROP CONSTRAINT IF EXISTS admissions_order_state_check;

ALTER TABLE admissions
  ADD CONSTRAINT admissions_order_state_check CHECK (
    (state = 'CREATING_ORDER' AND paypal_order_id IS NULL) OR
    state = 'ABORTED' OR
    (state <> 'CREATING_ORDER' AND state <> 'ABORTED' AND paypal_order_id IS NOT NULL)
  );
