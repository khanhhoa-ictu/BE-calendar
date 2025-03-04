create database calendar;
CREATE TABLE user (
    id int AUTO_INCREMENT PRIMARY KEY,
    email varchar(255),
    password varchar(255),
    token_forgot varchar(255),
    role int
);
DROP TABLE user;