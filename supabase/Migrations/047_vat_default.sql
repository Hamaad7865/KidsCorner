-- 047 — the Z report's VAT fallback rate was frozen at zero.
--
-- Migration 20260818090000 replaced the settings read in z_totals with
-- `v_default_vat := 0` as a compatibility shim, with the frozen VAT snapshot
-- merged over the return boundary. That variable is still read by the legacy
-- VAT-band block: a fully discounted ticket (total and VAT both zero) takes
-- its rate from it, and any implied rate within half a point of it is snapped
-- to it. At zero, nothing ever snaps to the shop's real rate — every rounding
-- wobble around 15% opens its own band on the VAT record instead of
-- collapsing to 15.00%.
--
-- Restores the settings read, falling back to the current VAT policy and then
-- the historical 15%. The frozen snapshot path is untouched: this only fixes
-- the fallback for tickets whose own rate cannot be implied.

do $$
declare
    v_def text;
    v_old text :=
        'v_default_vat := 0; -- compatibility variable; frozen output is merged below';
    v_new text :=
        'SELECT coalesce((value #>> ''{}'')::NUMERIC, 0.15) INTO v_default_vat' || chr(10)
        || '      FROM settings WHERE key = ''vat_rate'';' || chr(10)
        || '    IF v_default_vat IS NULL THEN' || chr(10)
        || '        SELECT max(configured_rate) INTO v_default_vat FROM vat_policies WHERE enabled;' || chr(10)
        || '    END IF;' || chr(10)
        || '    IF v_default_vat IS NULL THEN v_default_vat := 0.15; END IF;';
begin
    select pg_catalog.replace(
        pg_catalog.pg_get_functiondef(p.oid),
        chr(13) || chr(10),
        chr(10)
    ) into v_def
    from pg_catalog.pg_proc p
    where p.proname = 'z_totals'
      and p.pronamespace = 'public'::pg_catalog.regnamespace;

    if v_def is null then
        raise exception 'z_totals does not exist';
    end if;

    -- Already migrated: the settings read is back.
    if pg_catalog.strpos(v_def, 'FROM settings WHERE key = ''vat_rate''') > 0 then
        return;
    end if;

    if pg_catalog.strpos(v_def, v_old) = 0 then
        raise exception 'z_totals does not match the expected pre-047 definition';
    end if;

    v_def := pg_catalog.replace(v_def, v_old, v_new);
    execute v_def;
end;
$$;
