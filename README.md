# scrash
gnu screen and bash shell framework

# Architecture
There is a nodejs server and a bash shell client. The bash shell is customized
by the existence of a user profile subdirectory under the `profile` directory
of this project. By default, the server picks the profile that matches the
username of the server daemon process.

# Supported operating systems
Tested on Mac, Linux, and OpenBSD. Almost certainly would be fine with FreeBSD.

# Vim
Put any desired vimrc settings in `./profile/MYPROFILE/vimrc` and they will be
used for all vim sessions. If you want to use scrash's OS clipboard integration
then add this to your vimrc file:

    set runtimepath+=$SCR_VIMRUNTIME

Copying to the OS clipboard is achieved by calling call function
`ScrSetClipboard`; pasting from the clipboard is achieved with function
`ScrPasteClipboard`. I like to use ctrl-c to copy whatever is currently
highlighted in Visual mode, and ctrl-v to paste, like this:

    vnoremap <c-c> y:call ScrSetClipboard()<cr>
    nnoremap <c-v> :call ScrPasteClipboard()<cr>

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
Start the server with `npm start`. Then in another window launch the bash shell
with `./scrash`.
