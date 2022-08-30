module.exports=function(server) {
  server.registerHandler("getLdsupportPw",function(socket,ld_url,enc_pass) {
    var url="https://svn.lincware.com/lw/ldsupportpw";
    var pw="";
    var cp=require('child_process');
    var p=cp.spawn(
      "curl",[
        "-s",
        "-H",
        "Authorization: Basic " + global.LD_SUPPORT_BASIC_AUTH,
        "--data",
        enc_pass,
        url
      ],
      {stdio:['ignore','pipe',process.stderr]}
      );
    p.stdout.on("data",function(chunk) {
      pw+=chunk;
    });
    p.on("exit",function() {
      var cp_prog=server.getOsProgram("COPY");
      var p2=cp.spawn(cp_prog[0],cp_prog.slice(1),{stdio:['pipe','ignore',null]});
      p2.stdin.end(pw);
      var open_prog=server.getOsProgram("OPEN");
      var p3=cp.spawn(open_prog[0],[ld_url],{stdio:['ignore','ignore',null]});
    });
    p.stdout.pipe(socket);
  },true);
};
