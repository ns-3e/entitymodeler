From the data platform lead: we're moving the ERP to Databricks. We need a clean logical model the
business can review (proper names, no ETL noise, PII flagged), a physical Databricks model derived from
it, a mapping from the legacy tables to the new model, and a dbt schema for the new physical tables.
Note: tbl_prod.cat_cd points at prod_category but there's no FK in the extract.
