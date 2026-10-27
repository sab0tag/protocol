# Weight data review (R4 slice)

The source measurements stay in the active profile's database. Invalid, future and unreviewed anomalous values are excluded before weekly means, current/start values, pace and doctor-report period filtering. Filtering a report period cannot hide the previous valid baseline used to detect a decimal/unit typo.

## Input/review policy

- Dates must be real local calendar dates, not future dates. Values must be finite numeric kilograms from 0.1 to 1000. These deliberately broad entry bounds are not clinical normal ranges and do not infer an age-specific goal.
- A difference greater than 10% from the last accepted value is put on review, regardless of elapsed time. This is a product rule to catch unit/decimal entry errors, not a clinical assessment or a recommended weight-change rate. Real long-term changes can be explicitly confirmed.
- A pending value does not become the next baseline. Confirmation records the exact value and timestamp; an edited value must pass review again. Confirming one large change can make a later measurement require a fresh check against that corrected baseline.
- Invalid numbers/dates cannot be approved as-is. They must be edited. No source measurement is silently changed or removed by aggregation.

## UI and compatibility

The main chart plots actual accepted measurements on a continuous time axis; weekly changes remain in a disclosure. History expands when review is needed. People can correct a value/date, inspect prior corrections, explicitly verify a large change or delete/undo a measurement. Narrow screens stack date and value inputs so the native date control is not cropped.

The report and its text export disclose the count excluded within the selected period. The source JSON export retains all source rows, including pending records and correction/review metadata. Existing encrypted sync carries optional fields without a schema/backup version change. No clinical instructions or targets are inferred from a measurement.

This covers weight input/aggregation/history. Full validation/quarantine for other clinical measurement types, normalized append-only action history and multi-plan report attribution remain separate work.
