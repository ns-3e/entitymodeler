---
title: Human resources (HR) data model
seo_title: HR database design: employee data model and ER diagram
description: An example human resources data model with ER diagram — employees and reporting lines, departments, jobs and positions, employment history, salaries, leave requests and performance reviews — with a data dictionary and SQL DDL.
section: Examples
order: 3
model: site/examples/human-resources.json
---

This example models the core of an HR system: employees and who they report to, the organization (departments, jobs, positions and work locations), each employee's history of positions and salaries, time off and performance reviews.

## Design notes

- **The reporting line is a self-relationship.** `employee.manager_id` points at another employee; the **Reporting Line** hierarchy turns it into an org chart.
- **Jobs and positions are different things.** A job is a definition with a pay grade ("Software Engineer II"); a position is a budgeted seat in a department for a job, and it can be vacant.
- **History is kept, not overwritten.** `employment_history` records each position held, and `salary` has effective dates, with exactly one open row per employee.
- **Sensitive data is flagged as PII**: names, contact details, date of birth, salary and review comments, so it can be masked or access-controlled.
- **Leave requests record who approved them**, a second relationship to employee.

To extend it: add `benefit_enrollment`, `payroll_run` and `payslip`, `training_course` and `certification`, or `job_application` for recruiting.

<!-- example -->

## Frequently asked questions

### How do you model a manager–employee relationship in a database?

Add a manager_id column on the employee table that references the same table's employee_id. Each employee has at most one direct manager, and walking the relationship upward gives the reporting chain.

### What is the difference between a job and a position in HR data?

A job describes the work and its pay band, and many people can share it. A position is one budgeted seat for a job in a department; it is filled by one employee or is vacant.
