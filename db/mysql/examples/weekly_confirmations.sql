-- Set @report_end before sourcing this file to choose the UTC ending date.
WITH RECURSIVE calendar AS (
    SELECT CAST(COALESCE(@report_end, UTC_DATE()) AS DATE) - INTERVAL 6 DAY AS day
    UNION ALL
    SELECT day + INTERVAL 1 DAY
    FROM calendar
    WHERE day < CAST(COALESCE(@report_end, UTC_DATE()) AS DATE)
),
daily_confirmations AS (
    SELECT DATE(confirmed_at) AS day, COUNT(*) AS confirmed_orders,
           SUM(total) AS confirmed_value_inr
    FROM order_fulfillments
    WHERE status = 'CONFIRMED'
      AND confirmed_at >= CAST(COALESCE(@report_end, UTC_DATE()) AS DATE) - INTERVAL 6 DAY
      AND confirmed_at < CAST(COALESCE(@report_end, UTC_DATE()) AS DATE) + INTERVAL 1 DAY
    GROUP BY DATE(confirmed_at)
)
SELECT c.day, COALESCE(d.confirmed_orders, 0) AS confirmed_orders,
       COALESCE(d.confirmed_value_inr, 0.00) AS confirmed_value_inr
FROM calendar c
LEFT JOIN daily_confirmations d ON d.day = c.day
ORDER BY c.day;
