#! /usr/bin/env perl
# parse an ICS file: grab all VEVENTs and output them as a CSV

local $/;

my $ics=<>;
print "date,summary,organizer,attendee1,attendee2,attendee3,attendee4,attendee5\n";
while ($ics=~m{^BEGIN:VEVENT\r?$(.+?)^END:VEVENT}smg) {
  my $vevent=$1;
  $vevent=~s{\r?\s{3}}{}smg;
  #print $vevent;
  my ($y,$m,$d) = $vevent=~m{^DTSTART:(\d{4})(\d\d)(\d\d)}m;
  my $date=sprintf "%02d/%02d/%d",$m,$d,$y;
  my ($summary)=$vevent=~m{^SUMMARY:(.*?)\r?$}sm;
  my ($organizer)=$vevent=~m{^ORGANIZER;.*?CN=([^:]+)}smg;
  my (@attendees)=$vevent=~m{^ATTENDEE;.*?CN=([^;]+)}smg;
  printf "%s,\"%s\",%s,%s\n",$date,$summary,$organizer,join(",",@attendees);
}
