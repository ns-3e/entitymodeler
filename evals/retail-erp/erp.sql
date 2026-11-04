-- Acme Retail legacy ERP extract (PostgreSQL). Inherited schema, no docs.
CREATE TABLE tbl_cust_mstr (
  cust_id BIGINT PRIMARY KEY,
  cust_nm VARCHAR(200) NOT NULL,
  cust_email_addr VARCHAR(320),
  ph_nbr VARCHAR(40),
  dob DATE,
  cust_typ_cd VARCHAR(10) REFERENCES lkp_cust_type (cust_typ_cd),
  crt_dt TIMESTAMP, upd_dt TIMESTAMP, etl_batch_id BIGINT
);
CREATE TABLE lkp_cust_type (cust_typ_cd VARCHAR(10) PRIMARY KEY, cust_typ_desc VARCHAR(100));
CREATE TABLE ord_status (status_cd VARCHAR(10) PRIMARY KEY, status_desc VARCHAR(100));
CREATE TABLE tbl_ord_hdr (
  ord_id BIGINT PRIMARY KEY,
  cust_id BIGINT NOT NULL REFERENCES tbl_cust_mstr (cust_id),
  ord_dt DATE NOT NULL,
  status_cd VARCHAR(10) REFERENCES ord_status (status_cd),
  ship_addr_line1 VARCHAR(200), ship_city VARCHAR(100), ship_ctry_cd CHAR(2),
  tot_amt NUMERIC(12,2),
  crt_dt TIMESTAMP, row_hash CHAR(64)
);
CREATE TABLE tbl_prod (prod_id INT PRIMARY KEY, prod_nm VARCHAR(200), sku VARCHAR(40) UNIQUE, unit_prc NUMERIC(10,2), cat_cd VARCHAR(10));
CREATE TABLE prod_category (cat_cd VARCHAR(10) PRIMARY KEY, cat_nm VARCHAR(100));
CREATE TABLE tbl_ord_line (
  ord_id BIGINT REFERENCES tbl_ord_hdr (ord_id),
  line_nbr INT,
  prod_id INT REFERENCES tbl_prod (prod_id),
  qty INT NOT NULL,
  unit_prc NUMERIC(10,2),
  PRIMARY KEY (ord_id, line_nbr)
);
CREATE TABLE prod_supplier_xref (prod_id INT REFERENCES tbl_prod (prod_id), supp_id INT REFERENCES tbl_supp (supp_id), PRIMARY KEY (prod_id, supp_id));
CREATE TABLE tbl_supp (supp_id INT PRIMARY KEY, supp_nm VARCHAR(200), ctry_cd CHAR(2));
