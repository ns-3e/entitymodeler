---
title: Library management system data model
seo_title: Library management system ER diagram and schema
description: An example library management system data model with ER diagram — books, authors, publishers, physical copies at branches, members, loans, holds and fines — showing a many-to-many relationship, with SQL DDL.
section: Examples
order: 4
model: site/examples/library-management.json
---

This example models a public library: the catalog of books, their authors and publishers, the physical copies held at each branch, library members, loans, holds and fines. It's a classic teaching example for entity-relationship modeling because it has a clear many-to-many relationship and the book-versus-copy distinction.

## Design notes

- **A book is not a copy.** `book` is the title in the catalog (ISBN, title, publisher); `book_copy` is a physical item with a barcode at one branch. Loans are of copies; holds are on books, because a member wants any available copy.
- **Books and authors are many-to-many.** `book_author` resolves it and keeps the order authors are credited in.
- **Loans keep their history.** `returned_on` is empty while a copy is out, so overdue loans are those past `due_on` with no return date.
- **Membership type is a reference list with its loan limit**, so rules live in data rather than code.
- **Fines belong to loans**, which ties every charge to the item and member involved.

To extend it: add `reservation_queue` positions, `digital_item` for e-books, `event` for library programs, or `inter_library_loan`.

<!-- example -->

## Frequently asked questions

### What are the entities in a library management system?

Book, author, publisher, book copy, branch, member, loan, hold and fine, with lookup tables for genre, language and membership type. Book and author are linked many-to-many through a book_author table.

### Why separate books from book copies?

A library owns several physical copies of the same title. Catalog details (title, ISBN, authors) belong to the book; barcode, location, condition and availability belong to each copy, and loans are recorded against copies.
