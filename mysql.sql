create database calendar;
USE calendar;
DROP TABLE user;
CREATE TABLE user (
    id int AUTO_INCREMENT PRIMARY KEY,
    email varchar(255),
    password varchar(255),
    token_forgot varchar(255),
    role int
);
CREATE TABLE event (
    id int AUTO_INCREMENT PRIMARY KEY,
    title varchar(255),
    description varchar(255),
    start_time datetime,
    end_time datetime,
    user_id int,
    FOREIGN KEY (user_id) REFERENCES user(id)
);
