<#!
Phase 2 Automated Blood Flow Script (PowerShell)
Steps:
 1. Register hospital user
 2. Register blood_bank org user
 3. Register donor user
 4. Login all users
 5. Hospital creates blood request
 6. Org creates recruit post
 7. Donor applies
 8. Org accepts application
 9. Fetch overview
#>

# Configuration
$BaseUrl = "http://localhost:8000/api"
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"

# Utility: simple POST with JSON
function Invoke-JsonPost($Url, $BodyObj, $Headers=@{}) {
    $json = ($BodyObj | ConvertTo-Json -Depth 5)
    return Invoke-RestMethod -Method Post -Uri $Url -Body $json -ContentType 'application/json' -Headers $Headers
}
function Invoke-JsonPut($Url, $BodyObj, $Headers=@{}) {
    $json = ($BodyObj | ConvertTo-Json -Depth 5)
    return Invoke-RestMethod -Method Put -Uri $Url -Body $json -ContentType 'application/json' -Headers $Headers
}

Write-Host "[1] Register hospital user" -ForegroundColor Cyan
$HospitalEmail = "hospital+$Timestamp@example.com"
$HospitalReg = Invoke-JsonPost "$BaseUrl/register/" @{ email=$HospitalEmail; password="Pass123!"; full_name="Hospital Demo"; role="hospital" }
$HospitalReg | Format-List
if(-not $HospitalReg.ok){ Write-Error "Hospital registration failed"; exit 1 }

Write-Host "[2] Register blood_bank org user" -ForegroundColor Cyan
$BloodBankEmail = "bloodbank+$Timestamp@example.com"
$BloodBankReg = Invoke-JsonPost "$BaseUrl/register/" @{ email=$BloodBankEmail; password="Pass123!"; full_name="Blood Bank Org"; role="blood_bank" }
$BloodBankReg | Format-List
if(-not $BloodBankReg.ok){ Write-Error "Blood bank registration failed"; exit 1 }

Write-Host "[3] Register donor user" -ForegroundColor Cyan
$DonorEmail = "donor+$Timestamp@example.com"
$DonorReg = Invoke-JsonPost "$BaseUrl/register/" @{ email=$DonorEmail; password="Pass123!"; full_name="Donor Person"; role="regular" }
$DonorReg | Format-List
if(-not $DonorReg.ok){ Write-Error "Donor registration failed"; exit 1 }

Write-Host "[4] Login all users" -ForegroundColor Cyan
$HospitalLogin = Invoke-JsonPost "$BaseUrl/login/" @{ email=$HospitalEmail; password="Pass123!" }
$BloodBankLogin = Invoke-JsonPost "$BaseUrl/login/" @{ email=$BloodBankEmail; password="Pass123!" }
$DonorLogin = Invoke-JsonPost "$BaseUrl/login/" @{ email=$DonorEmail; password="Pass123!" }
"Hospital token: $($HospitalLogin.token.Substring(0,16))..."
"BloodBank token: $($BloodBankLogin.token.Substring(0,16))..."
"Donor token: $($DonorLogin.token.Substring(0,16))..."
if(-not $HospitalLogin.token -or -not $HospitalLogin.csrf_token){ Write-Error "Hospital login failed"; exit 1 }
if(-not $BloodBankLogin.token -or -not $BloodBankLogin.csrf_token){ Write-Error "Blood bank login failed"; exit 1 }
if(-not $DonorLogin.token -or -not $DonorLogin.csrf_token){ Write-Error "Donor login failed"; exit 1 }

$HospitalHeaders = @{ 'X-Auth-Token' = $HospitalLogin.token; 'X-CSRF-Token' = $HospitalLogin.csrf_token }
$BloodBankHeaders = @{ 'X-Auth-Token' = $BloodBankLogin.token; 'X-CSRF-Token' = $BloodBankLogin.csrf_token }
$DonorHeaders = @{ 'X-Auth-Token' = $DonorLogin.token; 'X-CSRF-Token' = $DonorLogin.csrf_token }

Write-Host "[5] Hospital creates blood request" -ForegroundColor Cyan
$RequestPayload = @{ blood_type = 'O+'; quantity_units = 3; needed_by = ((Get-Date).AddHours(12).ToString('s')); notes = 'Emergency need demo' }
$BloodRequest = Invoke-JsonPost "$BaseUrl/blood/requests" $RequestPayload $HospitalHeaders
$BloodRequest | Format-List
$RequestId = $BloodRequest.id
if(-not $RequestId){ Write-Error "Blood request creation failed"; exit 1 }

Write-Host "[6] Org creates recruit post" -ForegroundColor Cyan
$RecruitPayload = @{ blood_request_id = $RequestId; target_blood_type = 'O+'; location_text = 'Central Clinic'; scheduled_at = ((Get-Date).AddHours(6).ToString('s')); notes = 'Community donor drive' }
$Recruit = Invoke-JsonPost "$BaseUrl/blood/recruit" $RecruitPayload $BloodBankHeaders
$Recruit | Format-List
$RecruitId = $Recruit.id
if(-not $RecruitId){ Write-Error "Recruit post creation failed"; exit 1 }

Write-Host "[7] Donor applies to recruit post" -ForegroundColor Cyan
$ApplyPayload = @{ availability_at = ((Get-Date).AddHours(5).ToString('s')); notes = 'Can donate once' }
$Application = Invoke-JsonPost "$BaseUrl/blood/recruit/$RecruitId/apply" $ApplyPayload $DonorHeaders
$Application | Format-List
$ApplicationId = $Application.id
if(-not $ApplicationId){ Write-Error "Application creation failed"; exit 1 }

Write-Host "[8] Org lists applications and accepts donor" -ForegroundColor Cyan
$Apps = Invoke-RestMethod -Method Get -Uri "$BaseUrl/blood/recruit/$RecruitId/applications" -Headers $BloodBankHeaders
($Apps.results | Format-Table | Out-String) | Write-Host
Write-Host "Accepting application $ApplicationId" -ForegroundColor Yellow
$AcceptResp = Invoke-JsonPost "$BaseUrl/blood/applications/$ApplicationId/status" @{ status = 'accepted' } $BloodBankHeaders
$AcceptResp | Format-List
if(-not $AcceptResp.ok){ Write-Error "Accepting application failed"; exit 1 }

Write-Host "[9] Fetch overview" -ForegroundColor Cyan
$Overview = Invoke-RestMethod -Method Get -Uri "$BaseUrl/blood/overview"
$Overview | Format-List
if(-not $Overview.open_by_blood_type){ Write-Warning "Overview returned no open requests (may indicate earlier failure)" }

Write-Host "Flow complete." -ForegroundColor Green

Write-Host "[10] (Optional) Create campaign (blood drive) by blood bank org" -ForegroundColor Cyan
try {
    $CampaignPayload = @{ title = "Blood Drive $Timestamp"; description = 'O+ priority units'; campaign_type = 'blood_drive'; starts_at = ((Get-Date).AddDays(1).ToString('s')); ends_at = ((Get-Date).AddDays(1).AddHours(6).ToString('s')); location_text = 'Main Hall'; target_metric='units'; target_value=50 }
    $Campaign = Invoke-JsonPost "$BaseUrl/campaigns" $CampaignPayload $BloodBankHeaders
    if($Campaign.id){
        Write-Host "Created campaign id=$($Campaign.id)" -ForegroundColor Green
        $CampaignId = $Campaign.id
    } else { Write-Warning "Campaign creation failed (skipping rest)" }
} catch { Write-Warning "Campaign creation error: $_" }

if($CampaignId){
    Write-Host "[11] Publish campaign (draft -> active)" -ForegroundColor Cyan
    try {
        $StatusResp = Invoke-JsonPost "$BaseUrl/campaigns/$CampaignId/status" @{ status='active' } $BloodBankHeaders
        if(-not $StatusResp.ok){ Write-Warning "Status change failed" }
    } catch { Write-Warning "Status change error: $_" }

    Write-Host "[12] Donor joins campaign" -ForegroundColor Cyan
    try {
        $JoinResp = Invoke-JsonPost "$BaseUrl/campaigns/$CampaignId/join" @{ role_label='volunteer' } $DonorHeaders
        if($JoinResp.id){ Write-Host "Donor joined campaign participation_id=$($JoinResp.id)" -ForegroundColor Green } else { Write-Warning "Join failed" }
    } catch { Write-Warning "Join error: $_" }

    Write-Host "[13] List campaign participants (public view)" -ForegroundColor Cyan
    try {
        $Participants = Invoke-RestMethod -Method Get -Uri "$BaseUrl/campaigns/$CampaignId/participants"
        ($Participants.results | Format-Table | Out-String) | Write-Host
    } catch { Write-Warning "List participants error: $_" }
}

Write-Host "Phase 2 + optional Phase 3 flow complete." -ForegroundColor Green
