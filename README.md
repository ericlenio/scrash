# scrash
gnu screen and bash shell framework

# Architecture
There is a nodejs server and a bash shell client.

# Testing
Test cases are found in `./tests/assertions` and
`./tests/gnu-screen-assertions` (specifically for tests related to gnu screen.

Tests are executed in several ways:

    # run all tests
    npm test
    # run all tests with test group prefix of "VIM"
    npm test -- -g VIM
    # run all tests with test group prefix of "BASIC" or "VIM"
    npm test -- -g "BASIC VIM"

# Running
Start the server with `npm start`. Then launch the bash shell with `./client`.
