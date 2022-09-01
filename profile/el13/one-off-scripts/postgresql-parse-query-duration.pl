#! /usr/bin/env perl
# this script can analyze postgresql log files for query durations when
# log_min_duration_statement is set
#
# Usage: postgresql-parse-query-duration.pl postgresql.log > duration-data.csv

my $capture_query_mode=0;
my $query='';
my $dt;
my $tm;
my $duration;
my $duration_units;
my $stats={};

while(my $l=<>) {
  if (! $capture_query_mode) {
    if ($l=~m{^(\d\d\d\d-\d\d-\d\d) (\d\d:\d\d:\d\d\S+).*LOG:\s+duration:\s+(\S+) (\w+).*?:(?:\s+(\S.*))?$}) {
      $dt=$1;
      $tm=$2;
      $duration=$3;
      $duration_units=$4;
      $query=$5;
      $capture_query_mode=1;
    }
  } else {
    if ($l=~m{^\s+(.*?)\s*$}) {
      my $qline=$1;
      $query.=' ' if $query;
      $query.=$qline;
    } else {
      $capture_query_mode=0;
      if (!$query) {
        printf "ERR:%s\n",$l;
        exit;
      }
      if (!$stats{$query}) {
        $stats{$query}=[];
      }
      push @{$stats{$query}},{dt_tm=>"$dt $tm",d=>$duration,du=>$duration_units};
    }
  }
}

my $query_id=1;
printf "query,query_id,utc_timestamp,duration,duration_units\n";
foreach my $query (sort keys %stats) {
  my $arr=$stats{$query};
  my $quoted_query=$query;
  $quoted_query=~s{"}{""}g;
  foreach my $dur (@$arr) {
    printf "\"%s\",%s,%s,%s,%s\n",$quoted_query,$query_id,$dur->{dt_tm},$dur->{d},$dur->{du};
  }
  $query_id++;
}
