# scrash
gnu screen and bash shell framework

# Architecture
There is a nodejs server and a bash shell client. The bash shell is customized
by the existence of a user profile subdirectory under the `profile` directory
of this project. By default, the server picks the profile that matches the
username of the server daemon process.

# Testing
Test cases are found in `./tests/*.test`.

Tests are executed in several ways:

    # run all tests
    npm test
    # run all tests with test group files that match on "basic"
    npm test -- -g basic
    # same as above, but also include test files that match on "vim"
    npm test -- -g "basic vim"

# Running
Start the server with `npm start`. Then launch the bash shell with `./client`.
