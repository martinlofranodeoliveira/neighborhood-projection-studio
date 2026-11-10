# Browser object-member policy

Source: root instruction for this foundation, 2026-11-10; marker `rootinstruction`.

The browser importer uses native `JSON.parse`: duplicate object members use the last member's value. Validation applies to the resulting closed object. This is not duplicate-member rejection and does not alter the frozen Python contract or its serializer. Duplicate IDs and array entries remain subject to their explicit semantic rules. No handwritten JSON parser is introduced.

The prepared CPU harness includes a native parse-policy check. Runtime acceptance of a last-member-valid schema field and rejection of a last-member-invalid schema field are queued for the actual `readStudy` implementation. Browser execution and hostile-depth/RSS isolation are not claimed.
