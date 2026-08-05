# scrash
gnu screen and bash shell framework

# Architecture
There is a nodejs server and a bash shell client. The bash shell is customized
by the existence of a user profile subdirectory under the `profile` directory
of this project. By default, the server picks the profile that matches the
username of the server daemon process.

# Conventions
The bash shell is customized with various functions whose names all begin with
a hyphen, with a few exceptions for "wrapper" functions to customize the
following executables: ssh, ssh-add, scp, sftp, screen, vim. There are a number
of exported shell variables, with prefix of `SCR_`. (Type `-vars` to see the
full list of shell variables.)

## platform-specific functions
You may define bash functions in a profile that only get loaded for a
particular platform you ssh to. To do this, the function name must begin with
`-platform-`, where `platform` is the lowercased output of running `uname`.

# Profile layout
A profile may contain these files:

| path                                         | notes                     |
| -------------------------------------------- | ------------------------- |
| `profile/MYPROFILE/bashrc`                   | this file is sourced for every new shell |
| `profile/MYPROFILE/bashrc-my.host`           | this file is sourced for every new shell (after the normal bashrc) but only if running on host `my.host` |
| `profile/MYPROFILE/bash-functions`           | this file is for your own custom functions, available with every shell |
| `profile/MYPROFILE/bash-functions-localhost` | this file is for your own custom functions, but only available with shells on your local machine |
| `profile/MYPROFILE/vimrc`                    | vimrc sourced for all vim sessions (see below) |
| `profile/MYPROFILE/vimrc-my.host`            | vimrc sourced for all vim sessions (after the normal vimrc) but only if running on host `my.host` |
| `profile/MYPROFILE/screenrc`                 | screenrc sourced for all gnu screen sessions |
| `profile/MYPROFILE/screenrc-my.host`         | screenrc sourced for all gnu screen sessions (after the normal screenrc) but only if running on host `my.host` |

# Supported operating systems
Tested on MacOS, Linux, Raspian (Raspberry Pi), and OpenBSD. Almost certainly
would be fine with FreeBSD.

# Vim
Put any desired vimrc settings in `./profile/MYPROFILE/vimrc` and they will be
used for all vim sessions. scrash's OS clipboard integration is always available;
no `runtimepath` setting is needed for it.

Your vimrc and scrash's vim plugins are not written to disk for vim to read. They
travel the same way every other scrash function does — as exported shell
functions, which `-vim-config` prints back out verbatim — and every vim that
scrash launches is handed that on a file descriptor, with `VIMINIT` set to
`source /dev/fd/3` for that invocation. Nothing is quoted, escaped or encoded
along the way, and no second copy of the configuration is kept. So vim is fully
configured on a host whose filesystem is readonly.

`:source /dev/fd/3` is an ordinary `:source` of an ordinary path, which is why
this works so well. It gets a real script context, so script-local (`s:`)
variables behave normally, and it runs in the buffer vim has already opened for
the file being edited, which is where a vimrc's buffer-local `:set` commands
belong. The file being edited is never touched: no buffer is created or emptied,
`BufRead` fires exactly once, and nothing lands in the undo history. And because
`:source` of a path is as old as vim itself, this reaches all the way back to the
**vim 7.1** on Ubuntu 8.

Nothing else does. A command line cannot hold an `:if` or an `:augroup` block,
and a `:function` body cannot be written with bars at all, so running the
configuration out of the environment as commands rather than sourcing it needs
`:source` of a buffer (vim 8.2.4594, 2022) or `execute()` (vim 7.4.2008, 2016) —
neither of which exists on a vim that old.

The configuration is never written to disk, so `VIMINIT` is not exported either —
it is only true while that descriptor is open, and the wrapper sets it for the
one invocation. A vim that scrash did *not* launch therefore starts unconfigured:
that means `vimdiff`, `view`, or a script calling vim by an absolute path. Every
route scrash controls is covered, including `$EDITOR` (so `git commit`,
`sudoedit` and `crontab -e`) and the `vim` shell function.

Two other consequences worth knowing: your vimrc may not use `:source` to pull in
another file that scrash does not know about (there is no file to be relative
to), and scrash's plugins load during vimrc processing rather than at
`runtimepath` plugin time, so their autocommands are registered ahead of vim's
own bundled plugins instead of after them. Anything of your own that you want on
`runtimepath` should be added to your vimrc with a path you control; scrash does
not provide a directory for it.

Copying to the OS clipboard is achieved by calling function `ScrSetClipboard`;
pasting from the clipboard is achieved with function `ScrPasteClipboard`. I
like to use ctrl-c to copy whatever is currently highlighted in Visual mode,
and ctrl-v to paste, like this:

    vnoremap <c-c> y:call ScrSetClipboard(@")<cr>
    nnoremap <c-v> :call ScrPasteClipboard()<cr>

# ssh
There are drop in replacement bash functions provided for ssh, scp, sftp, and
ssh-add. They have logic to contact ssh-agent by a single-use http proxy, with
each use requiring a one time password (OTP) generated by the server. Each time
one of the ssh functions is called, an OTP is pasted into the OS clipboard and
the user must paste it into the terminal window (after being prompted) to
proceed with the ssh-agent http proxy. For convenience, once the OTP is pasted
(within ~10 seconds), whatever was previously in the OS clipboard is restored
to the clipboard.

# passwords
scrash includes a `-pw` shell function to retrieve and manage your passwords
from a gpg-encrypted file. Here's how it works: set up your system to run
`gpg-agent` (note: this is automatic on Mac), then set up
`$HOME/.config/scrash/config` like this:

    SCR_PASSWORD_FILE=/path/to/passwords.asc

with this colon-delimited format for each line:
`description:username:password`, for example,

    mail.google.com:eric@lincware.com:my-secret-password

then, calling `-pw mail.google.com | -set-clipboard` from the shell would copy
your Gmail password onto the OS clipboard. Note that a colon cannot be used as
part of the password since it is the delimeter.

You can control which part of the line gets returned by passing `-i X`, where
`X` is the 0th index of the line you want returned when splitting on colons.
For example, this will return all descriptions in the password file that match
on `SSH-KEY`:

    -pw -i 0 SSH-KEY

To edit your password file in vim, simply run `-pw -e`. Type `-pw -h` for a few
other options.

## gpg setup
By default, when scrash starts it will initialize your password file if it does
not exist. You also need to set `SCR_PASSWORD_KEY_ID` to the short ID of your
preferred gpg key to use for encryption/decryption of the password file. Here's
what I ran on my Mac to initialize a gpg key for the password file if you need
it:

    gpg --quick-generate-key "Eric Lenio <eric@lincware.com>" ed25519 default never
    # now inspect output of "gpg --list-secret-keys --keyid-format short", and
    # set SCR_PASSWORD_KEY_ID to the 8 character ID. This next command adds a
    # subkey necessary for encryption when using ed25519.
    gpg --batch --quick-add-key $SCR_PASSWORD_KEY_ID cv25519 encr never

Finally, add `export SCR_PASSWORD_KEY_ID=xxxxxxxx` into your personal bashrc.

## copying gpg pub/private keys to another system

    keyid=62E8908EA7F905BFA49B6C04A4E70411424EAD8E
    gpg --export $keyid | ssh new-system gpg --import
    gpg --export-secret-key $keyid | ssh new-system gpg --import

# Testing
Test cases are found in `./tests/*.test`, and they are just bash scripts that
get executed with shell options `set -o errexit -o errtrace` enabled, meaning
that if any statement in any of these bash scripts finishes with a non-zero
return value then that is considered a failure and testing is immediately
stopped.

Tests are executed in several ways:

    # run all tests
    npm test
    # run all tests with a custom profile
    npm test -- -P MYPROFILE
    # run all tests with test files that match (glob style) on "basic"
    npm test -- -g basic
    # same as above, but also include test files that match on "vim"
    npm test -- -g "basic vim"

If the last line of output is `SUCCESS`, then all test cases (in theory) were
successful.

# Running
Run `./scrash` to start both the server and client inside a new gnu screen
session.

Run `./scrash -h` for other command line options.
