---
title: Hospital management system data model
seo_title: Hospital management system ER diagram and schema
description: An example hospital management data model with ER diagram — patients, doctors, departments, appointments, admissions, wards and beds, diagnoses, prescriptions, invoices and insurance — with a data dictionary and SQL DDL.
section: Examples
order: 5
model: site/examples/hospital-management.json
---

This example models the core records of a hospital: patients and their insurance, doctors and departments, outpatient appointments, inpatient admissions to wards and beds, diagnoses, prescriptions and invoices.

## Design notes

- **Outpatient and inpatient care are separate.** An `appointment` is a scheduled visit; an `admission` is a stay with a bed, an attending doctor and admission and discharge times.
- **Diagnoses can come from either.** `diagnosis` links to the patient and, optionally, to the admission or the appointment where it was made. Codes use ICD-10.
- **Medications are a formulary.** `prescription` links a patient, a prescribing doctor and a medication, with dosage and dates.
- **Most patient data is PII or health data**, and is flagged so it can be masked, encrypted or excluded from analytics. Real systems also need audit trails and consent records.
- **Specialty and blood type are reference lists** with their values.

This is a teaching example, not a clinical system: real hospital data follows standards such as HL7 FHIR and local regulations (for example HIPAA in the United States).

<!-- example -->

## Frequently asked questions

### What tables are in a hospital management system database?

Typically patient, doctor, department, appointment, admission, ward, bed, diagnosis, medication, prescription, invoice and insurance provider, with lookup tables such as specialty and blood type.

### How do you model inpatient admissions and beds?

An admission links a patient to a bed and an attending doctor, with admitted and discharged timestamps. Beds belong to wards, and wards to departments, so occupancy can be reported at each level.
