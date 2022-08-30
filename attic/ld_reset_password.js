module.exports=function(server) {
  server.registerHandler("getLdPasswordResetParams",function(socket) {
    var util=require('util');
    socket.write( util.format( "LD_PW_INIT_SALT='%s';", global.LD_PW_INIT_SALT ) );
    socket.write( util.format( "LD_PW_SALT_SIZE='%s';", global.LD_PW_SALT_SIZE ) );
    socket.write( util.format( "LD_PW_HASH_ALG='%s';", global.LD_PW_HASH_ALG ) );
    socket.end( util.format( "LD_PW_DGST_ITERATIONS='%s';", global.LD_PW_DGST_ITERATIONS ) );
  });
};
