-- Shared validation helpers (ADR 002, condition 2): every check and its edge cases.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(30);

-- ===== check_json_object =====
select lives_ok(
  $$ select private.check_json_object('{"a": 1, "b": null}', array['a', 'b', 'c'], 'BAD', 'FIELD') $$,
  'check_json_object: known keys pass (missing keys are fine)'
);
select throws_ok(
  $$ select private.check_json_object('{"a": 1, "price": 5}', array['a'], 'BAD', 'FIELD') $$,
  'P0001', 'FIELD', 'check_json_object: an unknown key raises the field code'
);
select throws_ok(
  $$ select private.check_json_object('[1]', array['a'], 'BAD', 'FIELD') $$,
  'P0001', 'BAD', 'check_json_object: an array raises the invalid code'
);
select throws_ok(
  $$ select private.check_json_object(null, array['a'], 'BAD', 'FIELD') $$,
  'P0001', 'BAD', 'check_json_object: NULL raises the invalid code'
);

-- ===== json_uuid =====
select is(
  private.json_uuid('{"id": "00000000-0000-0000-0000-00000000000A"}', 'id', 'BAD'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'json_uuid: a uuid string is accepted (any case)'
);
select throws_ok($$ select private.json_uuid('{}', 'id', 'BAD') $$, 'P0001', 'BAD', 'json_uuid: missing');
select throws_ok($$ select private.json_uuid('{"id": null}', 'id', 'BAD') $$, 'P0001', 'BAD', 'json_uuid: null');
select throws_ok($$ select private.json_uuid('{"id": "abc"}', 'id', 'BAD') $$, 'P0001', 'BAD', 'json_uuid: not a uuid');
select throws_ok($$ select private.json_uuid('{"id": 5}', 'id', 'BAD') $$, 'P0001', 'BAD', 'json_uuid: a number');

-- ===== json_int =====
select is(private.json_int('{"q": 1}', 'q', 1, 99, 'BAD'), 1::bigint, 'json_int: the minimum is accepted');
select is(private.json_int('{"q": 99}', 'q', 1, 99, 'BAD'), 99::bigint, 'json_int: the maximum is accepted');
select throws_ok($$ select private.json_int('{"q": 0}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: below the range');
select throws_ok($$ select private.json_int('{"q": 100}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: above the range');
select throws_ok($$ select private.json_int('{"q": 1.5}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: a fraction');
select throws_ok($$ select private.json_int('{"q": -1}', 'q', 0, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: a negative number');
select throws_ok($$ select private.json_int('{"q": "5"}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: a string');
-- jsonb keeps 1.0 as written (1e2, by contrast, is stored as 100: a whole number, accepted).
select throws_ok($$ select private.json_int('{"q": 1.0}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: 1.0 has a fraction part');
select throws_ok($$ select private.json_int('{}', 'q', 1, 99, 'BAD') $$, 'P0001', 'BAD', 'json_int: missing');
select throws_ok(
  $$ select private.json_int('{"q": 1234567890123456}', 'q', 1, 9999999999999999, 'BAD') $$,
  'P0001', 'BAD', 'json_int: more than 15 digits'
);

-- ===== json_text =====
select is(private.json_text('{"n": "  crisp  "}', 'n', 200, 'BAD'), 'crisp', 'json_text: trimmed');
select is(private.json_text('{"n": "   "}', 'n', 200, 'BAD'), null, 'json_text: blank becomes NULL');
select is(private.json_text('{}', 'n', 200, 'BAD'), null, 'json_text: missing is NULL');
select is(private.json_text('{"n": null}', 'n', 200, 'BAD'), null, 'json_text: null is NULL');
select throws_ok($$ select private.json_text('{"n": 5}', 'n', 200, 'BAD') $$, 'P0001', 'BAD', 'json_text: a number');
select throws_ok(
  format($$ select private.json_text(%L::jsonb, 'n', 200, 'BAD') $$, jsonb_build_object('n', repeat('x', 201))),
  'P0001', 'BAD', 'json_text: longer than the maximum'
);

-- ===== clean_text, require_reason =====
select is(private.clean_text('  Ali ', 80, 'BAD'), 'Ali', 'clean_text: trimmed');
select throws_ok(
  format($$ select private.clean_text(%L, 80, 'BAD') $$, repeat('x', 81)),
  'P0001', 'BAD', 'clean_text: longer than the maximum'
);
select is(private.require_reason('  Customer left  '), 'Customer left', 'require_reason: trimmed');
select throws_ok($$ select private.require_reason('   ') $$, 'P0001', 'REASON_REQUIRED', 'require_reason: blank');
select throws_ok(
  format($$ select private.require_reason(%L) $$, repeat('x', 301)),
  'P0001', 'REASON_TOO_LONG', 'require_reason: longer than 300 characters'
);

select * from finish();
rollback;
