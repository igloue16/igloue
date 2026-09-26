begin;

select plan(10);

select ok(to_regprocedure('public.get_payment_exception_operator_case(uuid)') is not null,
          'operator case read RPC exists');
select ok(has_function_privilege('service_role', 'public.get_payment_exception_operator_case(uuid)', 'EXECUTE'),
          'service_role can inspect a case');
select ok(not has_function_privilege('public', 'public.get_payment_exception_operator_case(uuid)', 'EXECUTE'),
          'PUBLIC cannot inspect a case');
select ok(not has_function_privilege('anon', 'public.get_payment_exception_operator_case(uuid)', 'EXECUTE'),
          'anon cannot inspect a case');
select ok(not has_function_privilege('authenticated', 'public.get_payment_exception_operator_case(uuid)', 'EXECUTE'),
          'authenticated customers cannot inspect a case');
select is(pg_get_function_arguments('public.get_payment_exception_operator_case(uuid)'::regprocedure),
          'p_exception_id uuid', 'exception ID is the only caller-controlled argument');
select ok((select prosecdef = false and proconfig @> array['search_path=""']
           from pg_proc where oid = 'public.get_payment_exception_operator_case(uuid)'::regprocedure),
          'case read is invoker security with a hardened search path');
select ok(pg_get_function_result('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          not ilike '%email%' and pg_get_function_result('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          not ilike '%phone%' and pg_get_function_result('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          not ilike '%payload%' and pg_get_function_result('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          not ilike '%provider_event%',
          'case read excludes customer contact and provider payload data');
select ok(pg_get_functiondef('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          like '%pa.status = ''requires_review''%'
          and pg_get_functiondef('public.get_payment_exception_operator_case(uuid)'::regprocedure)
          like '%r.payment_status = ''requires_review''%',
          'case read accepts only the paid requires-review lifecycle');
set local role service_role;
select is((select count(*)::integer from public.get_payment_exception_operator_case('00000000-0000-4000-8000-00000000ffff')),
          0, 'unknown exception returns no case and read succeeds for service role');
reset role;

select * from finish();
rollback;
