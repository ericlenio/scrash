" vim:comments+=b\:"
fu ScrMktmpdir()
  " make sure the temp directory exists (for long running vim sessions, because
  " a cron job might delete it) - any time we do a vim "system" command this
  " function should be called first
  let @a=fnamemodify(tempname(),":p:h")
  if ! isdirectory(@a)
    call mkdir(@a,"p",0700)
  endif
endf

fu ScrPasteClipboard(...)
  " paste contents of OS clipboard
  try
    " otp might have been passed as arg1, else prompt user for it
    "call ScrSystemcaller("-ws-set-clipboard-otp")
    "if a:0==0
      "let l:otp=inputsecret("OTP? ")
    "else
      "let l:otp=a:1
    "endif
    "let [l:clipboard,l:stderr,l:rc]=ScrSystemcaller("-get-clipboard ".l:otp)
    let [l:clipboard,l:stderr,l:rc]=ScrSystemcaller("-get-clipboard")
    if len(l:stderr) > 0
      echohl WarningMsg
      echon join(l:stderr," ")
      echohl None
      echon " "
    endif
    if l:rc == 0
      let l:atEndOfLine=col("$")-col(".")==1
      let l:offset=l:atEndOfLine ? 0 : 1
      let l:line=getline('.')
      let l:leftPart=strpart(l:line,0,col('.')-l:offset)
      let l:rightPart=strpart(l:line,col('.')-l:offset)
      if len(l:clipboard) > 1
        call setline('.',l:leftPart.l:clipboard[0])
        call remove(l:clipboard,0)
        let l:clipboard[-1].=l:rightPart
        call append('.',l:clipboard)
      elseif len(l:clipboard) == 1
        call setline('.',l:leftPart.l:clipboard[0].l:rightPart)
      endif
      echo "\rpasted" strlen(join(l:clipboard,'')) "characters"
    endif
  catch /.*/
    echo v:exception
  endtry
endf

" returns a list of: stdout, stderr, and shell return code
fu ScrSystemcaller(cmd,...)
  call ScrMktmpdir()
  " have stderr lines get prefixed with "stderr:" - also see shellredir
  let cmd=a:cmd." 2> >(while true; do read -r l; rc=$?; [ ${#l} -gt 0 ] && echo \"stderr:$l\"; [ $rc -gt 0 ] && break; done)"
  if a:0 == 1
    let l:result=system(cmd,a:1)
  else
    let l:result=system(cmd)
  endif
  let l:stdout=[]
  let l:stderr=[]
  for l:line in split(l:result,'\n')
    if l:line =~ '^stderr:'
      let l:stderr+=[l:line]
    else
      let l:stdout+=[l:line]
    endif
  endfor
  return [l:stdout,l:stderr,v:shell_error]
endf

fu ScrSetClipboard(contents)
  " copies the contents of arg 1, else the unnamed register, to OS clipboard;
  " NOTE: the system command will write out to a temp file which is vim's
  " tempname() function
  if len(a:contents) == 0
    echon "Nothing to copy!"
    return
  endif
  try
    let [l:stdout,l:stderr,l:rc]=ScrSystemcaller("-set-clipboard",a:contents)
    if len(l:stderr) > 0
      echohl WarningMsg
      echon join(l:stderr," ")
      echohl None
      echon " "
    endif
    if l:rc == 0
      echon "Copied " len(a:contents) " characters"
    endif
  catch /.*/
    echo v:exception
  endtry
endf
