#!/usr/bin/env perl
# Sunrise: search catalina.out for log messages from DocumentHandler and gather
# up the duration of the search ("search took XXXX")

my $sql;
my $sqlHash={};
my $data=[];
my $duration_units="ms";

while (<>) {
  if (m{^.*?DocumentHandler- getSearchResults:SQL:(.*)$}) {
    $sql=$1;
    $sqlHash->{$sql}++;
  } elsif (m{^(\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d).*?DocumentHandler- search took (\d+)}) {
    my ($ts,$duration)=($1,$2);
    push $data,[$ts,$duration,$sql];
    #printf "%s,%s,%s\n",$ts,$duration,$sql;
  }
}

my $query_id=1;
foreach my $sql (sort keys %$sqlHash) {
  foreach my $d (@$data) {
    if ($d->[2] eq $sql) {
      push $d,$query_id;
    }
  }
  $query_id++;
}

#printf "sql,query_id,timestamp_edt,duration,duration_units\n";
printf "query_id,timestamp_edt,duration,duration_units\n";
foreach my $d (@$data) {
  my $quoted_sql=$d->[2];
  $quoted_sql=~s{"}{""}g;
  #printf "\"%s\",%s,%s,%s,%s\n",$quoted_sql,$d->[3],$d->[0],$d->[1],$duration_units;
  printf "%s,%s,%s,%s\n",$d->[3],$d->[0],$d->[1],$duration_units;
}
