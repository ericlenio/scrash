# scrash
gnu screen and bash shell framework

# Architecture
There is a nodejs server and a bash shell client. The bash shell is customized
by the existence of a user profile subdirectory under the `profile` directory
of this project. By default, the server picks the profile that matches the
username of the server daemon process.

# Testing
Test cases are found in `./tests/*.test`, and they are just bash scripts that
get executed with shell option `set -o errexit` enabled, meaning that if any
statement in any of these bash scripts finishes with a non-zero return value
then that is considered a failure and testing is immediately stopped (note: the
stopping of the test cases can be somewhat confounded if the error happens in a
subshell).

Tests are executed in several ways:

    # run all tests
    npm test
    # run all tests with test files that match (glob style) on "basic"
    npm test -- -g basic
    # same as above, but also include test files that match on "vim"
    npm test -- -g "basic vim"

If the last line of output is `SUCCESS`, then all test cases (in theory) were
successful.

# Running
Start the server with `npm start`. Then launch the bash shell with `./client`.
