---
title: Student enrollment (university) data model
seo_title: University database design: student enrollment ER diagram
description: An example university student enrollment data model with ER diagram — students, programs, departments, courses and prerequisites, course sections in terms, instructors, enrollments and grades — with SQL DDL.
section: Examples
order: 6
model: site/examples/student-enrollment.json
---

This example models course registration at a university: students in degree programs, departments and their courses, prerequisites between courses, the sections of each course offered in a term and taught by an instructor, and students' enrollments with their grades.

## Design notes

- **A course is not a section.** `course` is the catalog entry (CS201, Data Structures, 4 credits); `course_section` is one offering in a term, with an instructor, a room and a capacity. Students enroll in sections.
- **Students and sections are many-to-many**, resolved by `enrollment`, which also holds the grade and status.
- **Prerequisites are a relationship from course to course**, resolved by `course_prerequisite` with a minimum grade.
- **Grades are a reference list with grade points**, so GPA can be calculated from the data.
- **Programs belong to departments and have a degree level**, so requirements and reporting follow the academic structure.

To extend it: add `classroom` and `meeting_time` for timetabling, `waitlist`, `tuition_invoice`, or `program_requirement` for degree audits.

<!-- example -->

## Frequently asked questions

### How do you model students and courses in a database?

Students and courses are many-to-many, but enrollments are really in a course section (one offering of a course in a term). An enrollment table links student and course_section and stores the grade.

### How do you model course prerequisites?

With a course_prerequisite table that has two foreign keys to course: the course with the requirement and the course required first, optionally with a minimum grade.
