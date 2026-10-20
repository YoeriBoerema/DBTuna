INSERT INTO "public"."DPF_TMP_15"
SELECT
    "tmp"."DPV_RID",
    CAST("values"."new_val_1" AS CHARACTER VARYING(128))
FROM "public"."DPF_TMP_PRE_COND_18" "tmp"
JOIN (
    SELECT
        "hash_table"."LAST_NAME_UPPER" AS "old_val_1",
        "seed_table"."LAST_NAME_UPPER" AS "new_val_1"
    FROM "public"."DPF_TMP_HASH_17" "hash_table"
    JOIN "public"."DPF_TMP_SEED_16" "seed_table"
      ON "hash_table"."MODULO" = "seed_table"."DPV_RID"
) "values"
  ON coalesce(cast("tmp"."LAST_NAME_UPPER" AS varchar(8000)), ']#NULL#[')
   = coalesce(cast("values"."old_val_1" AS varchar(8000)), ']#NULL#[');
