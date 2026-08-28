Pata Kazi Backend

The Pata Kazi Backend is the server side API for Pata Kazi, a
task based platform that connects people who need help with everyday
jobs to people looking for work. It handles user authentication, tasks,
offers, messaging, and payments while providing a secure API for the
Pata Kazi frontend.
Tech Stack

Node.js

Express.js

MongoDB

Mongoose

JSON Web Tokens (JWT)

bcrypt

Authentication

Pata Kazi uses JWT authentication to protect private routes. After
logging in, the client receives a token that can be sent with requests
using:
